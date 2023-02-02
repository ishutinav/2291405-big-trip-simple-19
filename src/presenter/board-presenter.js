import SortView from '../view/sort-view.js';
import TripListView from '../view/trip-list-view.js';
import EmptyListView from '../view/empty-list-view.js';
import LoadingView from '../view/loading-view.js';
import PointPresenter from './point-presenter.js';
import NewPointPresenter from './new-point-presenter.js';
import {render, remove, RenderPosition} from '../framework/render.js';
import {SortType, TimeLimit} from '../const.js';
import {sortPriceDown, sortDateUp} from '../utils/point.js';
import {UserAction, UpdateType, FilterType} from '../const.js';
import {filter} from '../utils/filter.js';
import UiBlocker from '../framework/ui-blocker/ui-blocker.js';

export default class BoardPresenter {
  #boardContainer = null;
  #pointsModel = null;
  #filterModel = null;
  #additionalDataModel = null;
  #newPointPresenter = null;
  #aviableDestinations = null;
  #aviableOffers = null;
  #onNewPointDestroy = null;

  #uiBlocker = new UiBlocker({
    lowerLimit: TimeLimit.LOWER_LIMIT,
    upperLimit: TimeLimit.UPPER_LIMIT
  });

  #pointPresenters = new Map();

  #tripListComponent = new TripListView();
  #loadingComponent = new LoadingView();
  #emptyListComponent = null;
  #sortComponent = null;

  #currentSortType = SortType.DATE_FROM;
  #filterType = FilterType.EVERYTHING;
  #isLoading = true;

  constructor({boardContainer, pointsModel, filterModel, additionalDataModel, onNewPointDestroy}) {
    this.#boardContainer = boardContainer;
    this.#pointsModel = pointsModel;
    this.#filterModel = filterModel;
    this.#onNewPointDestroy = onNewPointDestroy;
    this.#additionalDataModel = additionalDataModel;

    this.#pointsModel.addObserver(this.#handleModelEvent);
    this.#additionalDataModel.addObserver(this.#handleModelEvent);
    this.#filterModel.addObserver(this.#handleModelEvent);
  }

  #handleModelEvent = (updateType, data) => {
    this.#uiBlocker.block();

    switch (updateType) {
      case UpdateType.PATCH:
        // - обновить часть списка (например, когда поменялось описание)
        this.#pointPresenters.get(data.id).init(data);
        break;
      case UpdateType.MINOR:
        // - обновить список (например, когда задача ушла в архив)
        this.#clearBoard();
        this.#renderBoard();
        break;
      case UpdateType.MAJOR:
        // - обновить всю доску (например, при переключении фильтра)
        this.#clearBoard({resetSortType: true});
        this.#renderBoard();
        break;
      case UpdateType.INIT:
        this.#isLoading = false;
        remove(this.#loadingComponent);
        break;
      case UpdateType.LOAD:
        this.#aviableDestinations = data.destinations;
        this.#aviableOffers = data.offers;
        break;
    }

    this.#uiBlocker.unblock();
  };

  createPoint() {
    this.#currentSortType = SortType.DATE_FROM;
    this.#filterModel.setFilter(UpdateType.MAJOR, FilterType.EVERYTHING);
    this.#newPointPresenter.init();
  }

  #clearBoard({resetSortType = false} = {}) {
    this.#pointPresenters.forEach((presenter) => presenter.destroy());
    this.#pointPresenters.clear();
    this.#newPointPresenter.destroy();

    remove(this.#sortComponent);
    remove(this.#loadingComponent);

    if (this.#emptyListComponent) {
      remove(this.#emptyListComponent);
    }

    if (resetSortType) {
      this.#currentSortType = SortType.DATE_FROM;
    }
  }

  #handleViewAction = async (actionType, updateType, update) => {
    switch (actionType) {
      case UserAction.UPDATE_POINT:
        this.#pointPresenters.get(update.id).setSaving();
        try {
          await this.#pointsModel.updatePoint(updateType, update);
        } catch(err) {
          this.#pointPresenters.get(update.id).setAborting();
        }
        break;
      case UserAction.ADD_POINT:
        this.#newPointPresenter.setSaving();
        try {
          await this.#pointsModel.addPoint(updateType, update);
        } catch(err) {
          this.#newPointPresenter.setAborting();
        }
        break;
      case UserAction.DELETE_POINT:
        this.#pointPresenters.get(update.id).setDeleting();
        try {
          await this.#pointsModel.deletePoint(updateType, update);
        } catch(err) {
          this.#pointPresenters.get(update.id).setAborting();
        }
        break;
    }
  };

  get points() {
    this.#filterType = this.#filterModel.filter;
    const points = this.#pointsModel.points;
    const filteredPoints = filter[this.#filterType](points);

    switch (this.#currentSortType) {
      case SortType.DATE_FROM:
        return filteredPoints.sort(sortDateUp);
      case SortType.PRICE:
        return filteredPoints.sort(sortPriceDown);
    }
    return filteredPoints;
  }

  init() {
    this.#newPointPresenter = new NewPointPresenter({
      tripListContainer: this.#tripListComponent.element,
      aviableDestinations: this.#aviableDestinations,
      aviableOffers: this.#aviableOffers,
      onDataChange: this.#handleViewAction,
      onDestroy: this.#onNewPointDestroy,
    });

    this.#renderBoard();
  }

  #renderPoint(point) {
    const pointPresenter = new PointPresenter({
      tripListContainer: this.#tripListComponent.element,
      aviableDestinations: this.#aviableDestinations,
      aviableOffers: this.#aviableOffers,
      onModeChange: this.#handleModeChange,
      onDataChange: this.#handleViewAction
    });
    pointPresenter.init(point);
    this.#pointPresenters.set(point.id, pointPresenter);
  }

  #renderLoading() {
    render(this.#loadingComponent, this.#boardContainer, RenderPosition.AFTERBEGIN);
  }

  #handleModeChange = () => {
    this.#newPointPresenter.destroy();
    this.#pointPresenters.forEach((presenter) => presenter.resetView());
  };

  #handleSortTypeChange = (sortType) => {
    if (this.#currentSortType === sortType) {
      return;
    }

    this.#currentSortType = sortType;
    this.#clearBoard({resetRenderedTaskCount: true});
    this.#renderBoard();
  };

  #renderSort() {
    this.#sortComponent = new SortView({
      onSortTypeChange: this.#handleSortTypeChange,
      currentSortType: this.#currentSortType
    });

    render(this.#sortComponent, this.#boardContainer, RenderPosition.AFTERBEGIN);
  }

  #renderPoints() {
    this.points.forEach((task) => this.#renderPoint(task));
  }

  #renderNoTrips() {
    this.#emptyListComponent = new EmptyListView({
      filterType: this.#filterType
    });
    render(this.#emptyListComponent, this.#boardContainer);
  }

  #renderTripList() {
    render(this.#tripListComponent, this.#boardContainer);
    this.#renderPoints();
  }

  #renderBoard() {
    if (this.#isLoading) {
      this.#renderLoading();
      return;
    }

    this.#renderSort();

    if (!this.points.length) {
      this.#renderNoTrips();
      return;
    }

    this.#renderTripList();
  }
}
